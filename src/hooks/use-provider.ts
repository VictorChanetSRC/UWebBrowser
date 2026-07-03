import { useSyncExternalStore } from "react";

import {
  getProviderId,
  getProviderReport,
  subscribeProvider,
  type ProviderReport,
} from "../lib/passwords";

/** The active password backend id and its last-known status, shared by the
 *  password panel and Settings so they never disagree within a session. */
export function useProvider(): { id: string; report: ProviderReport | null } {
  const id = useSyncExternalStore(subscribeProvider, getProviderId);
  const report = useSyncExternalStore(subscribeProvider, getProviderReport);
  return { id, report };
}
