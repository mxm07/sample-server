# Sample Server

Personal audio sample library server with a lightweight web UI. The server runs on a Windows machine and exposes a simple API to browse, stream, and download audio samples. Access is secured with WireGuard (VPN) so only your laptop can connect.

## Requirements

- Python 3.11+
- uv (https://github.com/astral-sh/uv)
- WireGuard for Windows (server) and macOS (client)

## Quickstart (server)

1) Create a virtual environment and install dependencies:

```
uv venv
uv pip install -e .
```

2) Set the sample library path:

```
$env:SAMPLE_SERVER_LIBRARY_PATH = "D:\\Samples"
```

3) Run the server:

```
uv run uvicorn sample_server.main:app --host 0.0.0.0 --port 8000
```

4) Open the UI from your laptop (over WireGuard):

```
http://<server-wireguard-ip>:8000/
```

## Environment variables

- `SAMPLE_SERVER_LIBRARY_PATH` (required): Path to the sample library root folder on the server.
- `SAMPLE_SERVER_AUDIO_EXTENSIONS` (optional): Comma-separated list of audio extensions, e.g. `.wav,.aiff,.flac`.
- `SAMPLE_SERVER_CORS_ORIGINS` (optional): Comma-separated list of allowed origins, or `*`.

## API

- `GET /api/health`
- `GET /api/list?path=<relative>`
- `GET /api/file?path=<relative>` (stream/playback)
- `GET /api/download?path=<relative>`

## Local client option

The UI is served by the server by default. If you want to run the UI locally on your laptop instead:

1) Set the server base URL in `client/config.js`, for example:

```
window.SAMPLE_SERVER_BASE_URL = "http://10.0.0.1:8000";
```

2) Run a local static server from `client/`:

```
python3 -m http.server 8080
```

3) Open `http://localhost:8080` in your browser.

Note: If you run the UI locally, CORS must allow the local origin.

## WireGuard setup (simple peer-to-peer)

This setup only allows the laptop to reach the server over a private VPN network.

### 1) Generate keys

On each device, generate a key pair. On Windows, use the WireGuard app "Add Tunnel" -> "Add empty tunnel" to generate keys. On macOS, use the WireGuard app to generate keys for a new tunnel.

### 2) Assign VPN IPs

Example private IPs:

- Server: `10.13.13.1/24`
- Laptop: `10.13.13.2/24`

### 3) Configure the server (Windows)

Example `server.conf`:

```
[Interface]
PrivateKey = <server-private-key>
Address = 10.13.13.1/24
ListenPort = 51820

[Peer]
PublicKey = <laptop-public-key>
AllowedIPs = 10.13.13.2/32
```

### 4) Configure the laptop (macOS)

Example `laptop.conf`:

```
[Interface]
PrivateKey = <laptop-private-key>
Address = 10.13.13.2/24
DNS = 1.1.1.1

[Peer]
PublicKey = <server-public-key>
Endpoint = <server-public-ip>:51820
AllowedIPs = 10.13.13.1/32
PersistentKeepalive = 25
```

### 5) Firewall and port forwarding

- Allow inbound UDP 51820 on the server host.
- If the server is behind a router, forward UDP 51820 to the server machine.

Once the tunnel is up, the laptop can reach the server at `http://10.13.13.1:8000/`.

## Security notes

- WireGuard uses key-based authentication; only peers with approved public keys can connect.
- Keep private keys secret.
- Bind the API to the WireGuard interface if you want to avoid LAN access.
