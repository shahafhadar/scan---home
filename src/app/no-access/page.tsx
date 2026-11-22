import { NoAccess } from "./NoAccess";

// Shown to a signed-in person whose account is not active. It must not call
// requireUser (that would redirect here again), so it stands on its own.
export const dynamic = "force-dynamic";

export default function NoAccessPage() {
  return <NoAccess />;
}
