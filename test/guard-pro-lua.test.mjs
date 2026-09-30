import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lua, lauxlib, lualib, to_jsstring, to_luastring } from 'fengari';

import { GuardPro } from '../dist/esm/pro.js';

const MICROS = 1_000_000;

/** Captures the exact script text GuardPro sends to Redis. */
async function captureScript() {
  let script = '';
  const client = {
    status: 'ready',
    async connect() {},
    async eval(source) {
      script = source;
      return [1, '0', '0'];
    },
    async get() {
      return null;
    },
    async del() {},
  };

  await new GuardPro({ redisUrl: 'redis://unit-lua-capture', redisClient: client, budget: 1, windowSeconds: 60 })
    .checkAndCharge('capture', 0);

  assert.ok(script.length > 0, 'expected GuardPro to send a Lua script');
  return script;
}

function setGlobal(state, name, value) {
  if (value === null || value === undefined) {
    lua.lua_pushnil(state);
  } else {
    lua.lua_pushstring(state, to_luastring(String(value)));
  }
  lua.lua_setglobal(state, to_luastring(name));
}

/**
 * Reads a stack value as a string. `lua_tostring` pushes a converted value for
 * numbers, so the stack depth is restored explicitly.
 */
function readStackString(state, index) {
  const top = lua.lua_gettop(state);
  const raw = lua.lua_tostring(state, index);
  const value = raw === null || raw === undefined ? null : typeof raw === 'string' ? raw : to_jsstring(raw);
  lua.lua_settop(state, top);
  return value;
}

function readGlobal(state, name) {
  const top = lua.lua_gettop(state);
  lua.lua_getglobal(state, to_luastring(name));
  const value = readStackString(state, -1);
  lua.lua_settop(state, top);
  return value;
}

/**
 * Executes the production Lua script against a minimal Redis stub so the
 * script's real syntax and arithmetic are verified instead of a mirrored copy.
 * The chunk is compiled once and reused so long drift runs stay cheap.
 */
function createRunner(script) {
  const source = `
    __execute = function()
      local __store = {}
      local __ttls = {}
      redis = {
        call = function(command, key, argument)
          if command == "GET" then
            return __store[key]
          end
          if command == "SET" then
            __store[key] = argument
            return "OK"
          end
          if command == "EXPIRE" then
            __ttls[key] = tonumber(argument)
            return 1
          end
          if command == "TTL" then
            return __ttls[key] or -1
          end
          error("unsupported command: " .. command)
        end,
        error_reply = function(message)
          error(message, 0)
        end,
      }
      local KEYS = { __KEY }
      local ARGV = { __AMOUNT, __TTL, __BUDGET }
      if __CURRENT ~= nil then
        __store[__KEY] = __CURRENT
        __ttls[__KEY] = tonumber(__CURRENT_TTL)
      end
      local function __run()
${script}
      end
      local __ok, __outcome = pcall(__run)
      if __ok then
        __decision = __outcome
      else
        __errorMessage = tostring(__outcome)
      end
      __storeValue = __store[__KEY]
      __storeTtl = __ttls[__KEY]
      return 1
    end
    __execute()
  `;

  const state = lua.lua_newstate();
  lualib.luaL_openlibs(state);

  if (lauxlib.luaL_loadbuffer(state, to_luastring(source), null, to_luastring('costguard')) !== lua.LUA_OK) {
    const message = to_jsstring(lua.lua_tostring(state, -1));
    lua.lua_close(state);
    throw new Error(`script failed to load: ${message}`);
  }
  if (lua.lua_pcall(state, 0, 0, 0) !== lua.LUA_OK) {
    const message = to_jsstring(lua.lua_tostring(state, -1));
    lua.lua_close(state);
    throw new Error(`script failed to run: ${message}`);
  }

  const run = ({ current = null, currentTtl = 60, ttl = 60, amount = 0, budget = 0 } = {}) => {
    const base = lua.lua_gettop(state);
    setGlobal(state, '__KEY', 'costguard:spend:lua');
    setGlobal(state, '__AMOUNT', amount);
    setGlobal(state, '__TTL', ttl);
    setGlobal(state, '__BUDGET', budget);
    setGlobal(state, '__CURRENT', current);
    setGlobal(state, '__CURRENT_TTL', current === null ? null : currentTtl);
    setGlobal(state, '__storeValue', null);
    setGlobal(state, '__storeTtl', null);
    setGlobal(state, '__decision', null);
    setGlobal(state, '__errorMessage', null);

    lua.lua_getglobal(state, to_luastring('__execute'));
    const status = lua.lua_pcall(state, 0, 0, 0);
    const failure = status === lua.LUA_OK ? null : to_jsstring(lua.lua_tostring(state, -1));
    lua.lua_settop(state, base);
    if (failure !== null) {
      throw new Error(`script raised: ${failure}`);
    }

    const result = {
      error: readGlobal(state, '__errorMessage'),
      stored: readGlobal(state, '__storeValue'),
      storedTtl: readGlobal(state, '__storeTtl'),
    };

    lua.lua_getglobal(state, to_luastring('__decision'));
    if (lua.lua_istable(state, -1)) {
      const length = lua.lua_rawlen(state, -1);
      const fields = [];
      for (let index = 1; index <= length; index += 1) {
        lua.lua_rawgeti(state, -1, index);
        fields.push(readStackString(state, -1));
        lua.lua_pop(state, 1);
      }
      result.allowed = Number(fields[0]) === 1;
      result.currentUsd = fields[1];
      result.projectedUsd = fields[2];
    }
    lua.lua_pop(state, 1);
    return result;
  };

  run.close = () => lua.lua_close(state);
  return run;
}

test('GuardPro Redis script is valid Lua that enforces the exact budget boundary', async () => {
  const run = createRunner(await captureScript());

  const first = run({ amount: 200_000, budget: 300_000 });
  assert.equal(first.error, null);
  assert.equal(first.allowed, true);
  assert.equal(first.stored, '0.2');
  assert.equal(first.storedTtl, '60');

  const second = run({ current: first.stored, amount: 100_000, budget: 300_000 });
  assert.equal(second.error, null);
  assert.equal(second.allowed, true, 'exactly-at-budget charge must be allowed');
  assert.equal(second.stored, '0.3');

  const third = run({ current: second.stored, amount: 1, budget: 300_000 });
  assert.equal(third.error, null);
  assert.equal(third.allowed, false);
  assert.equal(third.stored, '0.3', 'a blocked charge must leave spend unchanged');

  run.close();
});

test('GuardPro Redis script does not drift across thousands of micro-dollar charges', async () => {
  const run = createRunner(await captureScript());
  const step = 60;
  const iterations = 5_000;

  let current = null;
  for (let index = 0; index < iterations; index += 1) {
    const micros = (index + 1) * step;
    const outcome = run({ current, amount: step, budget: MICROS });
    assert.equal(outcome.error, null);
    assert.equal(outcome.allowed, true);
    assert.equal(outcome.projectedUsd, toUsd(micros));
    current = outcome.stored;
  }

  assert.equal(current, '0.3');

  let naive = 0;
  for (let index = 0; index < iterations; index += 1) {
    naive += 0.00006;
  }
  assert.notEqual(naive, 0.3, 'sanity: naive float accumulation drifts');

  run.close();
});

test('GuardPro Redis script normalizes legacy float values and rejects garbage', async () => {
  const run = createRunner(await captureScript());

  const legacy = run({ current: '0.30000000000000004', amount: 0, budget: 300_000 });
  assert.equal(legacy.error, null);
  assert.equal(legacy.allowed, true);
  assert.equal(legacy.stored, '0.3');

  const rounded = run({ current: '0.1234567', amount: 0, budget: 300_000 });
  assert.equal(rounded.stored, '0.123457');

  const garbage = run({ current: 'not-a-number', amount: 0, budget: 300_000 });
  assert.match(String(garbage.error), /unreadable spend value/u);
  assert.equal(garbage.allowed, undefined);

  const negative = run({ current: '-1', amount: 0, budget: 300_000 });
  assert.match(String(negative.error), /unreadable spend value/u);

  const outOfRange = run({ current: '1e12', amount: 0, budget: 300_000 });
  assert.match(String(outOfRange.error), /out of range/u);

  run.close();
});

test('GuardPro Redis script preserves a live window TTL', async () => {
  const run = createRunner(await captureScript());

  const fresh = run({ amount: 1_000, budget: MICROS, ttl: 3_600 });
  assert.equal(fresh.storedTtl, '3600');

  const live = run({ current: '0.001', currentTtl: 60, amount: 1_000, budget: MICROS, ttl: 3_600 });
  assert.equal(live.stored, '0.002');
  assert.equal(live.storedTtl, '60', 'an existing 60s TTL must be preserved, not reset to 3600');

  run.close();
});

function toUsd(micros) {
  const whole = Math.trunc(micros / MICROS);
  const text = String(micros % MICROS).padStart(6, '0').replace(/0+$/, '');
  return text === '' ? String(whole) : `${whole}.${text}`;
}
