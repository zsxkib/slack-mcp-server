import { z } from "zod";
import { server } from "../server.js";
import { getSlackClient } from "../slack/client.js";
import type { User, UserProfile } from "../slack/types.js";
import { mapSlackError, formatErrorForMcp } from "../utils/errors.js";
import { buildCursorPaginationResult } from "../utils/pagination.js";

interface SlackUser {
  id?: string;
  name?: string;
  real_name?: string;
  profile?: {
    display_name?: string;
  };
  is_bot?: boolean;
  is_admin?: boolean;
  deleted?: boolean;
}

function mapUser(user: SlackUser): User {
  return {
    id: user.id ?? "",
    name: user.name ?? "",
    realName: user.real_name ?? null,
    displayName: user.profile?.display_name ?? null,
    isBot: user.is_bot ?? false,
    isAdmin: user.is_admin ?? false,
    deleted: user.deleted ?? false,
  };
}

const listUsersInputSchema = {
  limit: z
    .number()
    .min(1)
    .max(1000)
    .optional()
    .describe("Maximum users to return (default: 200)"),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor from previous response"),
};

const userSchema = z.object({
  id: z.string().describe("User ID"),
  name: z.string().describe("Username"),
  realName: z.string().nullable().describe("User's real name"),
  displayName: z.string().nullable().describe("User's display name"),
  isBot: z.boolean().describe("Whether the user is a bot"),
  isAdmin: z.boolean().describe("Whether the user is a workspace admin"),
  deleted: z.boolean().describe("Whether the user account is deactivated"),
});

const listUsersOutputSchema = {
  users: z.array(userSchema).describe("List of users"),
  nextCursor: z
    .string()
    .nullable()
    .describe("Cursor for next page, null if no more results"),
};

server.registerTool(
  "list_users",
  {
    description: "List workspace users. User IDs are already included in message outputs — no need to call this to resolve user IDs from messages.",
    inputSchema: listUsersInputSchema,
    outputSchema: listUsersOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ limit, cursor }) => {
    try {
      const client = getSlackClient();
      const response = await client.users.list({
        limit: limit ?? 200,
        cursor: cursor ?? undefined,
      });

      if (!response.ok) {
        throw new Error(response.error ?? "Unknown Slack API error");
      }

      const users = (response.members ?? []).map((member) =>
        mapUser(member as SlackUser)
      );

      const result = buildCursorPaginationResult(
        users,
        response.response_metadata
      );

      const output = {
        users: result.items,
        nextCursor: result.nextCursor,
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(output),
          },
        ],
        structuredContent: output,
      };
    } catch (error) {
      const mcpError = mapSlackError(error);
      return formatErrorForMcp(mcpError);
    }
  }
);

const getUserProfileInputSchema = {
  user_id: z.string().describe("User ID (e.g., U1234567890)"),
};

const userProfileSchema = z.object({
  displayName: z.string().describe("User's display name"),
  realName: z.string().describe("User's real name"),
  title: z.string().nullable().describe("User's job title"),
  email: z.string().nullable().describe("User's email address"),
  phone: z.string().nullable().describe("User's phone number"),
  statusText: z.string().nullable().describe("User's current status text"),
  statusEmoji: z.string().nullable().describe("User's current status emoji"),
  image72: z.string().nullable().describe("URL to user's 72x72 avatar image"),
});

const getUserProfileOutputSchema = {
  profile: userProfileSchema.describe("User profile information"),
};

server.registerTool(
  "get_user_profile",
  {
    description:
      "Get detailed profile information for a specific user. " +
      "User IDs are included in message output as 'name (U...)' — extract the ID in parens.",
    inputSchema: getUserProfileInputSchema,
    outputSchema: getUserProfileOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  async ({ user_id }) => {
    try {
      const client = getSlackClient();
      const response = await client.users.profile.get({
        user: user_id,
      });

      if (!response.ok) {
        throw new Error(response.error ?? "Unknown Slack API error");
      }

      const profile = response.profile;
      const userProfile: UserProfile = {
        displayName: profile?.display_name ?? "",
        realName: profile?.real_name ?? "",
        title: profile?.title ?? null,
        email: profile?.email ?? null,
        phone: profile?.phone ?? null,
        statusText: profile?.status_text ?? null,
        statusEmoji: profile?.status_emoji ?? null,
        image72: profile?.image_72 ?? null,
      };

      const output = { profile: userProfile };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(output),
          },
        ],
        structuredContent: output,
      };
    } catch (error) {
      const mcpError = mapSlackError(error, { userId: user_id });
      return formatErrorForMcp(mcpError);
    }
  }
);
