// The .secrets folder, locked to its owner. POSIX file modes do nothing on NTFS: on Windows the
// folder inherits "Users: read" and "Authenticated Users: modify" from the repository. Every script
// that reads or writes a secret calls lockSecrets() first. It removes inheritance, grants full
// control to the current user, SYSTEM and Administrators, makes every file inherit only that, then
// checks the result by SID — not by account names, which are localized — and removes any other
// entry it finds. It throws if anything but those three is left.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

export const SECRETS = '.secrets';
const SYSTEM = 'S-1-5-18';
const ADMINS = 'S-1-5-32-544';

const icacls = (args) => {
  const r = spawnSync('icacls', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`icacls ${args.join(' ')}: ${r.stdout}${r.stderr}`);
};

// Windows PowerShell started from PowerShell 7 inherits its PSModulePath and then cannot load its
// own Get-Acl; without the variable it builds its default one.
const psEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'psmodulepath'));
const powershell = (command) =>
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', env: psEnv });

/** The current user's SID and, for the folder and each file under it, the SIDs its ACL names. */
function aclSids() {
  const script = `
$ErrorActionPreference = 'Stop'
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$items = @(Get-Item -LiteralPath '${SECRETS}' -Force) + @(Get-ChildItem -LiteralPath '${SECRETS}' -Force -Recurse)
$acl = foreach ($i in $items) { [pscustomobject]@{ path = $i.Name; sids = @((Get-Acl -LiteralPath $i.FullName).Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }) } }
[pscustomobject]@{ me = $me; acl = @($acl) } | ConvertTo-Json -Depth 4 -Compress`;
  const r = powershell(script);
  if (r.status !== 0) throw new Error(`could not read the ACL of ${SECRETS}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

export function lockSecrets() {
  fs.mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    fs.chmodSync(SECRETS, 0o700);
    for (const f of fs.readdirSync(SECRETS)) fs.chmodSync(`${SECRETS}/${f}`, 0o600);
    return;
  }
  const { me } = aclSids();
  // The folder: no inheritance, three owners, passed down to what it contains.
  icacls([SECRETS, '/inheritance:r', '/grant:r', `*${me}:(OI)(CI)F`, `*${SYSTEM}:(OI)(CI)F`, `*${ADMINS}:(OI)(CI)F`, '/Q']);
  // Each file: explicit entries dropped, inheritance from the locked folder restored.
  for (const f of fs.readdirSync(SECRETS)) icacls([`${SECRETS}\\${f}`, '/reset', '/Q']);
  // Any other SID left on the folder (an explicit entry from before) is removed, then all is checked.
  const allowed = new Set([me, SYSTEM, ADMINS]);
  const first = aclSids();
  for (const sid of new Set(first.acl.flatMap((a) => a.sids))) if (!allowed.has(sid)) icacls([SECRETS, '/remove:g', `*${sid}`, '/T', '/Q']);
  const left = aclSids().acl.flatMap((a) => a.sids.filter((s) => !allowed.has(s)).map((s) => `${a.path}: ${s}`));
  if (left.length) throw new Error(`${SECRETS} is still open to: ${left.join(', ')}`);
}

/**
 * One secret file outside .secrets (another repository's env file), locked the same way: no
 * inheritance, the current user, SYSTEM and Administrators only, checked by SID.
 */
export function lockFile(file) {
  if (process.platform !== 'win32') {
    if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
    return;
  }
  if (!fs.existsSync(file)) fs.writeFileSync(file, '');
  const { me } = aclSids();
  icacls([file, '/inheritance:r', '/grant:r', `*${me}:F`, `*${SYSTEM}:F`, `*${ADMINS}:F`, '/Q']);
  const sidsOf = () => {
    const lit = file.replace(/'/gu, "''");
    const r = powershell(`(Get-Acl -LiteralPath '${lit}').Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }`);
    if (r.status !== 0) throw new Error(`could not read the ACL of ${file}: ${r.stderr}`);
    return r.stdout.split(/\r?\n/u).filter(Boolean);
  };
  const allowed = new Set([me, SYSTEM, ADMINS]);
  for (const sid of sidsOf()) if (!allowed.has(sid)) icacls([file, '/remove:g', `*${sid}`, '/Q']);
  const left = sidsOf().filter((s) => !allowed.has(s));
  if (left.length) throw new Error(`${file} is still open to ${left.join(', ')}`);
}

/** Run as a script: lock the folder and print who may read it, by SID. */
if (process.argv[1]?.replace(/\\/gu, '/').endsWith('scripts/secrets-dir.mjs')) {
  lockSecrets();
  if (process.platform === 'win32') for (const a of aclSids().acl) console.log(`${a.path}: ${[...new Set(a.sids)].join(', ')}`);
}
