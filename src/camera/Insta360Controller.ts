export class Insta360Controller {
  private _connected = false;
  private _baseUrl = 'http://192.168.1.1:80';

  async connect(wifiIp?: string): Promise<boolean> {
    if (wifiIp) this._baseUrl = `http://${wifiIp}:80`;
    try {
      const res = await fetch(`${this._baseUrl}/osc/info`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'camera', type: 'camera' }),
      });
      if (res.ok) { this._connected = true; return true; }
    } catch {}
    return false;
  }

  get isConnected() { return this._connected; }
  get streamUrl() { return this._connected ? `${this._baseUrl}/osc/live` : null; }
  disconnect() { this._connected = false; }
}

export const insta360Controller = new Insta360Controller();
