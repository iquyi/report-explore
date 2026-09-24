import type {
  ReportTemplate,
  ResearchLedger,
  ReviewResult,
} from "./types";

type ArtifactMap = {
  template: { template: ReportTemplate; variableValues: Record<string, string> };
  research: ResearchLedger;
  html: {
    title: string;
    markdown: string;
    html: string;
    revision: "draft" | "repair";
  };
  review: ReviewResult;
};

export type ArtifactKind = keyof ArtifactMap;
export type ArtifactId<KIND extends ArtifactKind = ArtifactKind> = string & {
  readonly __kind?: KIND;
};

/** 完整事实账本与 HTML 仅保存在单次请求的内存中，绝不进入主 Agent 上下文。 */
export class ReportArtifactStore {
  private readonly artifacts = new Map<
    string,
    { kind: ArtifactKind; value: ArtifactMap[ArtifactKind] }
  >();

  put<KIND extends ArtifactKind>(kind: KIND, value: ArtifactMap[KIND]) {
    const id = crypto.randomUUID() as ArtifactId<KIND>;
    this.artifacts.set(id, { kind, value });
    return id;
  }

  get<KIND extends ArtifactKind>(id: string, kind: KIND): ArtifactMap[KIND] {
    const artifact = this.artifacts.get(id);
    if (!artifact || artifact.kind !== kind) {
      throw new Error(`无效的 ${kind} artifact ID。`);
    }
    return artifact.value as ArtifactMap[KIND];
  }
}
