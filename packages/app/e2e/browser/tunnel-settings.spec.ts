import { createServer, type Server } from "node:net";
import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { getServerId } from "../support/helpers/server-id";
import { openSettingsHost, openSettingsHostSection } from "../support/helpers/settings";

test("Tunnel import keeps failure beside the form, retries, and exposes the one-time token", async ({
  context,
  page,
}) => {
  const occupied = await occupyLoopbackPort();
  try {
    const gate = await installDaemonWebSocketGate(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoAppShell(page);
    await openSettings(page);
    const serverId = getServerId();
    await openSettingsHost(page, serverId);
    await openSettingsHostSection(page, serverId, "tunnel");

    await page.getByRole("button", { name: "Import egress" }).click();
    await page.getByLabel("Tunnel name").fill("Browser retry egress");
    await page.getByLabel("Route Offer").fill(JSON.stringify(routeOffer(occupied.port)));
    await page.getByLabel("Listener port").fill(String(occupied.port));

    const save = page.getByRole("button", { name: "Save", exact: true });
    gate.holdNextClientRequest("tunnel.http.entry.mutate.request");
    await save.click();
    await gate.waitForHeldClientRequest();
    await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    gate.releaseHeldClientRequest();
    await expect(page.getByText(/EADDRINUSE|address already in use/)).toBeVisible();
    await expect(save).toBeEnabled();

    await closeServer(occupied.server);
    await save.click();

    const tokenResult = page.getByText("Access token ready", { exact: true });
    await expect(tokenResult).toBeVisible();
    await expect(page.getByText(/^pat-/)).toBeVisible();
    const copy = page.getByRole("button", { name: "Copy", exact: true });
    await copy.click();
    await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  } finally {
    if (occupied.server.listening) await closeServer(occupied.server);
  }
});

function routeOffer(suggestedPort: number) {
  return {
    protocolVersion: 1,
    relayEndpoint: "http://127.0.0.1:8481",
    relayUseTls: false,
    tunnelServerId: "browser-test-ingress",
    tunnelPublicKeyB64: "unused-until-a-request-is-forwarded",
    routeId: "route_browser_test",
    routeSecret: "secret_browser_test",
    ingressHostName: "Fixture Host",
    ingressName: "Fixture Ingress",
    suggestedPort,
  };
}

async function occupyLoopbackPort(): Promise<{ server: Server; port: number }> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");
  return { server, port: address.port };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
