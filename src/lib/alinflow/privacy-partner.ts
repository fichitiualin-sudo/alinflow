import type { PrivacyParty } from "./privacy-notice";

/** A business identity for future notices, never a maintenance access grant. */
export type PrivacyPartnerCandidate = {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  party: PrivacyParty;
  issues: string[];
};
