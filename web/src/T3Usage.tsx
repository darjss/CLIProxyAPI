import { useMutation, useQuery } from "@tanstack/react-query";
import { css } from "../styled-system/css";
import { button } from "../styled-system/recipes";
import { api } from "./api";
import { Progress } from "./pages/SetupPage";
import { CodeBlock, Modal, actions, caption, formError } from "./ui";

type SetupCode = { code: string; command: string };
type SetupStatus = {
  status: "waiting" | "installed" | "expired";
  t3?: boolean;
};

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
  const create = useMutation({
    mutationFn: () =>
      api<SetupCode>("/setup", {
        method: "POST",
        body: JSON.stringify({ harness: "t3", model: "" }),
      }),
  });
  const code = create.data?.code;
  const status = useQuery({
    queryKey: ["setup", code],
    queryFn: ({ signal }) => api<SetupStatus>("/setup/" + code, { signal }),
    enabled: !!code,
    refetchInterval: (query) =>
      query.state.data?.t3 || query.state.data?.status === "expired"
        ? false
        : 2000,
  });
  const state = status.data;

  return (
    <Modal title="See your usage in T3 Code?" onClose={() => onClose()}>
      {create.data ? (
        <div className={css({ display: "grid", gap: "14px" })}>
          <p className={caption}>
            Paste this in a terminal on the computer where you use T3 Code. It
            needs T3 Code 0.1.3 or newer, and tells you if yours is older.
          </p>
          <CodeBlock
            label="T3 Code setup command"
            value={create.data.command}
          />
          <Progress
            done={state?.status === "installed"}
            active={state?.status !== "expired"}
          >
            {state?.status === "expired"
              ? "That command expired. Close this and try again later."
              : state?.status === "installed"
                ? "Command ran."
                : "Waiting for the command to run."}
          </Progress>
          <Progress done={!!state?.t3} active={state?.status === "installed"}>
            {state?.t3
              ? "T3 Code is reading Pool usage. Open its Usage page to see the accounts."
              : "Waiting for T3 Code to check in. Open T3 Code if it's closed."}
          </Progress>
          <div className={actions}>
            <button
              className={button({ variant: state?.t3 ? "primary" : "ghost" })}
              onClick={() => onClose()}
            >
              {state?.t3 ? "Done" : "Close"}
            </button>
          </div>
        </div>
      ) : (
        <div className={css({ display: "grid", gap: "14px" })}>
          <p className={caption}>
            Do you use T3 Code? Pool can add its shared Claude and ChatGPT
            accounts to T3 Code's Usage page, so you can see how much room is
            left without opening Pool. One command sets it up.
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
