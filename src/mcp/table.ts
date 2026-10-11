// The MCP server's tools (docs/spec.md §15, ADR 0023): one per /v1 call an API key may make, each a
// name for a method and a path. Their descriptions and argument schemas come from docs/openapi.yaml
// (scripts/build-mcp.mjs → schemas.gen.ts), so a tool cannot say other than the API does; a test
// holds this table to the contract both ways.

/** The server's name and version: in every answer, the server card and the registry entry. */
export const SERVER_INFO = { name: 'clx', title: 'clx — analytics and short links on your Cloudflare', version: '1.0.0' };

export interface ToolRow {
  name: string;
  title: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The /v1 path, `{id}` for the object's id. */
  path: string;
  /** A mutation that replaces or removes what is there (its tool's `destructiveHint`), not only adds. */
  destructive?: true;
}

export const TABLE: readonly ToolRow[] = [
  { name: 'whoami', title: 'The caller: plan, limits, current use', method: 'GET', path: '/v1/me' },
  { name: 'list_accounts', title: 'List connected Cloudflare accounts', method: 'GET', path: '/v1/accounts' },
  { name: 'connect_account', title: 'Connect a Cloudflare account', method: 'POST', path: '/v1/accounts' },
  { name: 'get_account', title: 'Get a connected account', method: 'GET', path: '/v1/accounts/{id}' },
  { name: 'disconnect_account', title: 'Disconnect a Cloudflare account', method: 'DELETE', path: '/v1/accounts/{id}', destructive: true },
  { name: 'list_zones', title: 'List an account’s zones', method: 'GET', path: '/v1/accounts/{id}/zones' },
  { name: 'install_account', title: 'Install the worker again', method: 'POST', path: '/v1/accounts/{id}/install', destructive: true },
  { name: 'renew_token', title: 'Renew the working token', method: 'POST', path: '/v1/accounts/{id}/token', destructive: true },
  { name: 'list_sites', title: 'List sites', method: 'GET', path: '/v1/sites' },
  { name: 'add_site', title: 'Add a site and get its snippet', method: 'POST', path: '/v1/sites' },
  { name: 'get_site', title: 'Get a site and its snippet', method: 'GET', path: '/v1/sites/{id}' },
  { name: 'update_site', title: 'Change a site’s excluded paths', method: 'PATCH', path: '/v1/sites/{id}', destructive: true },
  { name: 'delete_site', title: 'Delete a site', method: 'DELETE', path: '/v1/sites/{id}', destructive: true },
  { name: 'rotate_site', title: 'Rotate a site’s path and snippet', method: 'POST', path: '/v1/sites/{id}/rotate', destructive: true },
  { name: 'site_report', title: 'A site’s report', method: 'GET', path: '/v1/sites/{id}/report' },
  { name: 'list_link_hosts', title: 'List link hosts', method: 'GET', path: '/v1/link-hosts' },
  { name: 'add_link_host', title: 'Add a link host, one per site', method: 'POST', path: '/v1/link-hosts' },
  { name: 'get_link_host', title: 'Get a link host', method: 'GET', path: '/v1/link-hosts/{id}' },
  { name: 'delete_link_host', title: 'Delete a link host', method: 'DELETE', path: '/v1/link-hosts/{id}', destructive: true },
  { name: 'list_links', title: 'List short links', method: 'GET', path: '/v1/links' },
  { name: 'add_link', title: 'Add a short link', method: 'POST', path: '/v1/links' },
  { name: 'get_link', title: 'Get a short link', method: 'GET', path: '/v1/links/{id}' },
  { name: 'update_link', title: 'Change a link’s URL or rules', method: 'PATCH', path: '/v1/links/{id}', destructive: true },
  { name: 'delete_link', title: 'Delete a short link', method: 'DELETE', path: '/v1/links/{id}', destructive: true },
  { name: 'link_qr', title: 'A link’s QR code as SVG', method: 'GET', path: '/v1/links/{id}/qr.svg' },
  { name: 'link_report', title: 'A link’s report', method: 'GET', path: '/v1/links/{id}/report' },
];

/** /v1 calls for a page session only (spec §15): not tools. */
export const SESSION_ONLY: readonly string[] = ['PATCH /v1/me', 'DELETE /v1/me', 'GET /v1/keys', 'POST /v1/keys', 'DELETE /v1/keys/{id}'];
