import { test, expect, type CDPSession, type Page } from '@playwright/test';

/**
 * Phase D — full WebAuthn passkey ceremony, end-to-end through the real
 * FE + API, using Chromium's virtual authenticator (the CDP `WebAuthn`
 * domain). This is the integration test the server-side
 * `server/tests/test_passkeys.py` header points at: the python suite
 * exercises the DB helpers + route wiring + the security gates, but
 * deliberately stops short of a real attestation/assertion because that
 * needs a fake authenticator. Here the browser's virtual authenticator
 * mints a genuine credential and the server's py_webauthn verifier
 * validates the real bytes — so registration AND authentication run the
 * actual cryptographic path, not a mock.
 *
 * What it covers:
 *   1. Anonymous "create an account with a passkey" from the SignInModal
 *      → server mints a user, verifies the attestation, issues a session.
 *   2. Sign out, then "sign in with a passkey" (usernameless / discoverable
 *      credential) → server resolves the user from the credential and
 *      issues a fresh session.
 *
 * Running it (NOT part of CI — E2E specs run manually against a live
 * stack, same as the rest of `tests/e2e/specs`):
 *   BASE_URL=https://<branch-slug>.dev.whoeverwants.com \
 *     npx playwright test --config=tests/e2e/config/playwright.config.ts \
 *     passkey-ceremony --project=chromium
 *
 * The target must be a real FE+API+DB with migration 113 applied and
 * passkeys enabled (PASSKEYS_DISABLED unset). The WebAuthn rp_id is
 * derived server-side from the request Origin (see
 * `services/fe_origin.py` allowlist), so `localhost:<port>` and any
 * `*.dev.whoeverwants.com` host both work; an unlisted host falls back
 * to whoeverwants.com and the ceremony fails the rp_id check.
 *
 * Chromium only — the virtual authenticator is a Chrome DevTools
 * Protocol feature; Firefox/WebKit have no equivalent, so the test
 * skips there.
 */

const SESSION_TOKEN_KEY = 'session_token';

/**
 * Register an internal (platform) virtual authenticator that auto-
 * satisfies user presence + user verification, so ceremonies complete
 * with no native UI. `transport: 'internal'` is what makes
 * `isUserVerifyingPlatformAuthenticatorAvailable()` return true — which
 * the FE requires before it surfaces the "Create an account with a
 * passkey" affordance (`platformPasskeySupported()` in lib/passkeys.ts).
 * `hasResidentKey: true` makes credentials discoverable, which the
 * usernameless sign-in flow (no allowCredentials list) depends on.
 */
async function installVirtualAuthenticator(page: Page): Promise<{
  client: CDPSession;
  authenticatorId: string;
}> {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  return { client, authenticatorId };
}

function readSessionToken(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_KEY);
}

test.describe('Passkey (WebAuthn) ceremony', () => {
  test('register a passkey account then sign in with it', async ({
    page,
    browserName,
  }) => {
    // CDP (and thus the virtual authenticator) is Chromium-only — bail
    // before touching newCDPSession on Firefox/WebKit.
    test.skip(
      browserName !== 'chromium',
      'Virtual authenticator is a Chromium-only CDP feature',
    );

    // Authenticator must exist before the FE probes
    // isUserVerifyingPlatformAuthenticatorAvailable() on page/modal mount.
    const { client, authenticatorId } = await installVirtualAuthenticator(page);

    await page.goto('/settings/');

    // --- Phase 1: anonymous create-account-with-a-passkey ---------------
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    const createBtn = page.getByRole('button', {
      name: /create an account with a passkey/i,
    });
    // The button only renders once platformPasskeySupported() resolves
    // true — i.e. once the virtual authenticator is visible to the page.
    await expect(createBtn).toBeVisible({ timeout: 15_000 });
    await createBtn.click();

    // saveSession() writes the token synchronously when the verify
    // response lands, independent of any React re-render — the most
    // reliable "we're signed in" signal.
    await expect
      .poll(() => readSessionToken(page), { timeout: 20_000 })
      .not.toBeNull();
    const tokenAfterRegister = await readSessionToken(page);

    // The virtual authenticator now holds exactly one discoverable
    // credential — proves a real credential was created, not a no-op.
    const afterRegister = await client.send('WebAuthn.getCredentials', {
      authenticatorId,
    });
    expect(afterRegister.credentials.length).toBe(1);

    // Settings reflects the signed-in account (SESSION_CHANGED_EVENT →
    // currentUser populated → "Sign-in methods" row appears).
    await expect(page.getByText('Sign-in methods')).toBeVisible({
      timeout: 15_000,
    });

    // --- Phase 2: sign out, then sign back in with the passkey ----------
    await page.getByRole('button', { name: /^sign out$/i }).click();
    await expect
      .poll(() => readSessionToken(page), { timeout: 15_000 })
      .toBeNull();

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const signInBtn = page.getByRole('button', {
      name: /sign in with a passkey/i,
    });
    await expect(signInBtn).toBeVisible({ timeout: 15_000 });
    await signInBtn.click();

    // Usernameless assertion: the server resolves the user from the
    // discoverable credential and issues a brand-new session token.
    await expect
      .poll(() => readSessionToken(page), { timeout: 20_000 })
      .not.toBeNull();
    const tokenAfterSignIn = await readSessionToken(page);
    expect(tokenAfterSignIn).not.toBeNull();
    expect(tokenAfterSignIn).not.toBe(tokenAfterRegister);

    await expect(page.getByText('Sign-in methods')).toBeVisible({
      timeout: 15_000,
    });
  });
});
