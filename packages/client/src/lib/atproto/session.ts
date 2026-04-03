import { Agent, CredentialSession } from "@atproto/api";

export function createPublicAgent(): Agent {
  return new Agent({ service: import.meta.env.VITE_ATPROTO_SERVICE });
}

export function createSessionAgent(
  accessJwt: string,
  refreshJwt: string,
  did: string,
): Agent {
  const service = import.meta.env.VITE_ATPROTO_SERVICE;
  const session = new CredentialSession(new URL(service));
  session.session = {
    accessJwt,
    refreshJwt,
    did,
    handle: "",
    active: true,
  };
  return new Agent(session);
}
