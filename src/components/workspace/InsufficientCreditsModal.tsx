"use client";

import * as React from "react";
import { Modal } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { INSUFFICIENT_CREDITS_EVENT } from "@/lib/vcaas";

/**
 * ═══⭐⭐ "YOU ARE OUT OF CREDITS" — ONE MODAL, EVERY ENDPOINT ═══════════════
 *
 * ⚠️⚠️ IT LISTENS RATHER THAN BEING CALLED, and that is the only version of this that
 * stays correct. Roughly forty `vcaasApi` methods can come back `INSUFFICIENT_CREDITS` —
 * a prompt, a publish, a rebuild, a file write, an export, an import, a visual edit — and
 * answering it at forty call sites means the forty-first forgets. `proxyRequest` is the
 * single chokepoint every one of them passes through, so it raises
 * `INSUFFICIENT_CREDITS_EVENT` once and this component answers it once.
 *
 * ⚠️ THE EVENT NEVER SWALLOWS THE RESPONSE. The caller still receives its refusal and
 * still handles it however it did before; this only adds the explanation on top.
 *
 * ── WHY THE LINK LEAVES THIS APP ────────────────────────────────────────────
 *
 * This builder runs on an operator balance or local orchestrator. If credits are exhausted,
 * the user or administrator must replenish tokens or switch models.
 */

export function InsufficientCreditsModal() {
    const [open, setOpen] = React.useState(false);

    React.useEffect(() => {
        const onEmpty = () => setOpen(true);
        window.addEventListener(INSUFFICIENT_CREDITS_EVENT, onEmpty);
        return () => window.removeEventListener(INSUFFICIENT_CREDITS_EVENT, onEmpty);
    }, []);

    return (
        <Modal
            open={open}
            onOpenChange={setOpen}
            size="sm"
            title="Action Limit Reached"
            description="This action requires additional AI credits or provider tokens. Please check your provider quota or settings and try again."
            footer={
                <Button onClick={() => setOpen(false)}>
                    Close
                </Button>
            }
        >
            <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs leading-relaxed">
                Ensure your API key has sufficient quota or switch to a free model in your environment settings.
            </p>
        </Modal>
    );
}
