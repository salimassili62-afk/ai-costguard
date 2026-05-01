# Security Policy

## Supported Versions

Only the latest version of AI Execution Firewall is supported with security updates.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately:

1. Send an email to the security team
2. Do not disclose the vulnerability publicly until it has been fixed
3. Include as much detail as possible to reproduce the issue

## Security Features

### Authentication
- Optional API key authentication for proxy mode via `x-firewall-api-key` header
- API keys stored in local config file (`~/.aifw/config.json`)

### Rate Limiting
- Per-IP rate limiting (configurable, default: 60 requests/minute)
- In-memory implementation for performance

### Data Privacy
- **Prompt Storage**: Prompt history is hash-only by default in `~/.aifw/history.jsonl`
- **Redaction Mode**: Optional redacted prompt storage can remove configured secrets, emails, and IDs
- **Plaintext Mode**: Full prompt storage is available only when explicitly configured with `privacy.promptStorage: "plaintext"`
- **Hash Storage**: SHA-256 hashes stored for duplicate detection
- **API Keys**: Not logged, only stored in config file
- **Local Only**: All data stored locally on user's machine
- **No Telemetry**: No external network calls

### Transport Security
- Proxy mode forwards requests to upstream APIs (OpenAI, Anthropic)
- Does not modify TLS/HTTPS connections
- Relies on upstream API security for data in transit

## Best Practices

1. **API Key Management**: Never commit API keys to version control
2. **Proxy Authentication**: Enable API key authentication in production deployments
3. **Log Retention**: Configure appropriate log retention based on your compliance requirements
4. **Network Isolation**: Deploy the proxy in a trusted network environment
