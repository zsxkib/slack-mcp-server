import { WebClient } from "@slack/web-api";

let slackClient: WebClient | null = null;

export function getSlackClient(): WebClient {
  if (!slackClient) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new Error(
        "SLACK_BOT_TOKEN environment variable is required. " +
          "Please set it to your Slack Bot User OAuth Token (xoxb-...)"
      );
    }
    slackClient = new WebClient(token);
  }
  return slackClient;
}

export function resetSlackClient(): void {
  slackClient = null;
}
