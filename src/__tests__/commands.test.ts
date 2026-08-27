import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BackgroundRegistry } from "../state.ts";
import { registerCommands } from "../commands.ts";

void describe("commands", () => {
    void it("/bg-version reports the loaded package version and path", async () => {
        const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
        const notices: string[] = [];
        const pi = {
            registerCommand(name: string, definition: { handler: (args: string, ctx: unknown) => Promise<void> }) {
                commands.set(name, definition);
            },
            sendMessage() {},
        };

        registerCommands(pi as never, new BackgroundRegistry());
        await commands.get("bg-version")?.handler("", {
            ui: {
                notify: (message: string) => notices.push(message),
            },
        });

        assert.ok(commands.has("bg"));
        assert.ok(commands.has("bg-list"));
        assert.ok(commands.has("bg-version"));
        // Fork: package renamed to pi-bg-tasks; the path assertion is relaxed
        // to "an absolute path follows" — the checkout directory name is
        // environment-dependent (upstream asserted /pi-patty-bg-tasks$/).
        assert.match(notices[0], /^pi-bg-tasks@\S+ loaded from /);
        assert.match(notices[0], /loaded from \//);
    });
});
