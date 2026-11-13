import { css } from "../styled-system/css";
import { button } from "../styled-system/recipes";
import { T3Setup, useT3Command } from "./pages/SetupPage";
import { Modal, actions, caption, formError } from "./ui";

/**
 * Asks people who already connected a tool whether they use T3 Code, then
 * hands them a one-time command that adds Pool to T3 Code's Usage page.
 * onClose(true) means "don't ask again".
 */
export default function T3Usage({
  onClose,
}: {
  onClose: (never?: boolean) => void;
}) {
  const create = useT3Command();

  return (
    <Modal title="See your usage in T3 Code?" onClose={() => onClose()}>
      {create.data ? (
        <div className={css({ display: "grid", gap: "14px" })}>
          <p className={caption}>
            Paste this in a terminal on the computer where you use T3 Code. It
            needs T3 Code 0.1.3 or newer, and tells you if yours is older.
          </p>
          <T3Setup command={create.data} onClose={() => onClose()} />
        </div>
      ) : (
        <div className={css({ display: "grid", gap: "14px" })}>
          <p className={caption}>
            Do you use T3 Code? Pool can add its shared Claude and ChatGPT
            accounts to T3 Code's Usage page, so you can see how much room is
            left without opening Pool. One command sets it up. It's also on the
            Quick Start page.
          </p>
          {create.isError && (
            <p role="alert" className={formError}>
              {create.error.message}
            </p>
          )}
          <div className={actions}>
            <button
              className={button({ variant: "ghost" })}
              onClick={() => onClose(true)}
            >
              No, I don't use it
            </button>
            <button
              className={button({ variant: "primary" })}
              disabled={create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating…" : "Yes, set it up"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
