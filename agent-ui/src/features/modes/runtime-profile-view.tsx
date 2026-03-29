import type { FC } from "react";

import type { RuntimeProfileSnapshot } from "./types";

type RuntimeProfileViewProps = {
  profile: RuntimeProfileSnapshot;
};

export const RuntimeProfileView: FC<RuntimeProfileViewProps> = ({ profile }) => {
  return (
    <div className="runtime-profile-view" aria-label="运行时策略快照">
      <div className="runtime-profile-row">
        <span className="runtime-profile-key">模型</span>
        <span className="runtime-profile-value">{profile.defaultModel}</span>
      </div>
      <div className="runtime-profile-row">
        <span className="runtime-profile-key">思考深度</span>
        <span className="runtime-profile-value">{profile.defaultReasoningEffort}</span>
      </div>
      <div className="runtime-profile-row">
        <span className="runtime-profile-key">沙箱</span>
        <span className="runtime-profile-value">{profile.sandboxMode}</span>
      </div>
      <div className="runtime-profile-row">
        <span className="runtime-profile-key">审批</span>
        <span className="runtime-profile-value">{profile.approvalPolicy}</span>
      </div>
      <div className="runtime-profile-row">
        <span className="runtime-profile-key">搜索</span>
        <span className="runtime-profile-value">{profile.webSearchMode}</span>
      </div>
    </div>
  );
};
