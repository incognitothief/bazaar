import { Agent } from "@atproto/api";
Agent
let _agent: Agent | null = null;

export function getAgent(): Agent {
  if (!_agent) {
    const service = process.env.ATPROTO_SERVICE ?? "https://bsky.social";
    _agent = new Agent({ service });
  }
  return _agent;
}
