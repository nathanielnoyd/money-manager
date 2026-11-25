import "server-only";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { env } from "../env";

export async function registrationOptions(user: {
  webauthnUserId: string;
  email: string;
  displayName: string;
  existingCredentialIds?: string[];
}) {
  return generateRegistrationOptions({
    rpName: env().rpName,
    rpID: env().rpId,
    userName: user.email,
    userDisplayName: user.displayName,
    userID: Buffer.from(user.webauthnUserId, "base64url"),
    attestationType: "none",
    excludeCredentials: (user.existingCredentialIds ?? []).map((id) => ({ id })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
}

export async function verifyRegistration(
  response: RegistrationResponseJSON,
  expectedChallenge: string,
) {
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: env().origin,
    expectedRPID: env().rpId,
    requireUserVerification: true,
  });
  if (!result.verified) return null;
  const info = result.registrationInfo;
  return {
    credentialId: info.credential.id,
    publicKey: Buffer.from(info.credential.publicKey),
    counter: info.credential.counter,
    transports: info.credential.transports ?? null,
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
  };
}

export async function authenticationOptions() {
  // Discoverable credentials: no allowCredentials, so we don't reveal which accounts exist.
  return generateAuthenticationOptions({ rpID: env().rpId, userVerification: "required" });
}
