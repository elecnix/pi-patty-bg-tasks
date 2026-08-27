import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerInputHandlers } from "../input.ts";
import { BackgroundRegistry } from "../state.ts";
import type { UiContext } from "../types.ts";

interface ResubmittedMessage {
    text: string;
    deliverAs?: string;
}

type InputHandler = (
    event: {
        type: "input";
        text: string;
        source: "interactive" | "rpc" | "extension";
        streamingBehavior?: "steer" | "followUp";
    },
    ctx: UiContext & {
        abort(): void;
        signal?: AbortSignal;
    }
) => Promise<
    | { action: "continue" }
    | { action: "transform"; text: string }
    | { action: "handled" }
>;

// Fork change: this fork drops the interrupt-on-input default. The input
// handler is a no-op — it never intercepts, never backgrounds, never aborts.
// Pi's native steering applies: the message is queued and delivered at the
// next turn boundary, and the running command is left alone. These tests pin
// that behavior (upstream's cooperative-steering tests were removed with the
// feature).
void describe("input steering (fork: queue, don't abort)", () => {
    void it("interactive input with a foreground job active is NOT intercepted — returns continue", async () => {
        const reg = new BackgroundRegistry();
        const sent: { customType?: string }[] = [];
        const resubmitted: ResubmittedMessage[] = [];
        let pauseReason: string | undefined;
        let abortCalled = false;
        const handler = registerAndGetHandler(reg, sent, resubmitted);
        reg.foreground.set("tc-steer", {
            requestPause: (reason) => {
                pauseReason = reason;
            },
        });

        const result = await handler(
            {
                type: "input",
                text: "stop and inspect the last failure",
                source: "interactive",
                streamingBehavior: "steer",
            },
            makeCtx([], { abort: () => { abortCalled = true; } })
        );

        assert.deepEqual(result, { action: "continue" });
        assert.equal(pauseReason, undefined, "must not background the foreground job");
        assert.equal(abortCalled, false, "must not abort the current turn");
        assert.equal(sent.length, 0, "must not send any agent message");
        assert.equal(resubmitted.length, 0, "must not resubmit the message");
    });

    void it("returns continue for extension-sourced input", async () => {
        const reg = new BackgroundRegistry();
        const sent: { customType?: string }[] = [];
        const resubmitted: ResubmittedMessage[] = [];
        const handler = registerAndGetHandler(reg, sent, resubmitted);
        reg.foreground.set("tc-ext", {
            requestPause: () => {},
        });

        const result = await handler(
            { type: "input", text: "self-resubmit", source: "extension", streamingBehavior: "steer" },
            makeCtx([], { abort: () => {} })
        );

        assert.deepEqual(result, { action: "continue" });
        assert.equal(sent.length, 0);
        assert.equal(resubmitted.length, 0);
    });

    void it("returns continue when no foreground task is active", async () => {
        const reg = new BackgroundRegistry();
        const sent: { customType?: string }[] = [];
        const resubmitted: ResubmittedMessage[] = [];
        const handler = registerAndGetHandler(reg, sent, resubmitted);

        const result = await handler(
            { type: "input", text: "any steering", source: "interactive", streamingBehavior: "steer" },
            makeCtx([], { abort: () => {} })
        );

        assert.deepEqual(result, { action: "continue" });
        assert.equal(sent.length, 0);
        assert.equal(resubmitted.length, 0);
    });
});

function registerAndGetHandler(
    reg: BackgroundRegistry,
    sent: { customType?: string }[],
    resubmitted: ResubmittedMessage[]
): InputHandler {
    let handler: InputHandler | undefined;
    registerInputHandlers(
        {
            on(event: string, fn: InputHandler) {
                if (event === "input") handler = fn;
            },
            sendMessage(message: { customType?: string }) {
                sent.push(message);
            },
            sendUserMessage(content: string | object[], options?: { deliverAs?: string }) {
                if (typeof content === "string") {
                    resubmitted.push({ text: content, deliverAs: options?.deliverAs });
                }
            },
        } as never,
        reg
    );
    assert.ok(handler);
    return handler;
}

function makeCtx(
    notifications: string[] = [],
    actions?: { abort(): void }
): UiContext & { abort(): void } {
    return {
        ui: {
            notify: (message) => notifications.push(message),
            setWidget: () => {},
            setStatus: () => {},
            theme: { fg: (_colour, text) => text },
            select: async () => undefined,
            editor: async () => undefined,
        },
        abort: actions?.abort ?? (() => {}),
    };
}
