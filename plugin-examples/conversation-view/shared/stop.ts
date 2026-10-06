import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const stopConversation = defineRpc({
  name: "conversation.stop",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({}),
});
