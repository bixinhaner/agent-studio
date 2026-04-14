import type { FC } from "react";

import type { RuntimeProfileSnapshot } from "./types";

type RuntimeProfileViewProps = {
  profile: RuntimeProfileSnapshot;
};

export const RuntimeProfileView: FC<RuntimeProfileViewProps> = ({ profile }) => {
  return (
    <div className="runtime-profile-view" aria-label="Runtime policy snapshot">
      <div className="runtime-profile-row">
        <span className="runtime-profile-key">Model</span>
        <span className="runtime-profile-value">{profile.defaultModel}</span>
      </div>
      <div className="runtime-profile-row">
        <span className="runtime-profile-key">Reasoning</span>
        <span className="runtime-profile-value">{profile.defaultReasoningEffort}</span>
      </div>
      <div className="runtime-profile-row">
        <span className="runtime-profile-key">Sandbox</span>
        <span className="runtime-profile-value">{profile.sandboxMode}</span>
      </div>
      <div className="runtime-profile-row">
        <span className="runtime-profile-key">Approval</span>
        <span className="runtime-profile-value">{profile.approvalPolicy}</span>
      </div>
      <div className="runtime-profile-row">
        <span className="runtime-profile-key">Search</span>
        <span className="runtime-profile-value">{profile.webSearchMode}</span>
      </div>
    </div>
  );
};
