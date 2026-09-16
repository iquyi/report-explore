BEGIN;

-- statement-breakpoint

-- Neon 基于 PostgreSQL；启用 pgcrypto 以提供 UUID 默认值生成函数。
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- statement-breakpoint

-- 模板主表保存模板元数据；blueprint 继续仅记录关联文件路径，不存储文件正文。
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL,
  description VARCHAR(500),
  variables JSONB NOT NULL DEFAULT '[]'::JSONB,
  explain_structure TEXT,
  consistency_rules TEXT,
  constraint_rules TEXT,
  exception_boundary_rules TEXT,
  verification_rules TEXT,
  type TEXT NOT NULL,
  status SMALLINT NOT NULL DEFAULT 0,
  blueprint TEXT,
  cover TEXT,
  group_id TEXT,
  is_draft SMALLINT NOT NULL DEFAULT 1,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 状态只允许停用（0）或启用（1）。
  CONSTRAINT templates_status_check CHECK (status IN (0, 1)),

  -- 草稿标记只允许否（0）或是（1）。
  CONSTRAINT templates_is_draft_check CHECK (is_draft IN (0, 1)),

  -- 模板类型只允许报告类或设计类 skill。
  CONSTRAINT templates_type_check CHECK (type IN ('report', 'design')),

  -- 模板变量使用 JSON 数组保存，数组项由应用层按 {key: text, value: text} 结构读写。
  CONSTRAINT templates_variables_array_check
    CHECK (jsonb_typeof(variables) = 'array'),

  -- 蓝图路径支持 JSON 或 HTML，并允许 URL 在扩展名后携带查询参数。
  CONSTRAINT templates_blueprint_path_check
    CHECK (blueprint ~* '\.(json|html)(\?.*)?$'),

  -- char_length 按字符计数，中文等多字节文本也按一个字符计算。
  CONSTRAINT templates_explain_structure_length_check
    CHECK (char_length(explain_structure) <= 10000),

  -- 四类可选规则分别限制在 1000 个字符以内；NULL 表示未配置该类规则。
  CONSTRAINT templates_consistency_rules_length_check
    CHECK (consistency_rules IS NULL OR char_length(consistency_rules) <= 1000),
  CONSTRAINT templates_constraint_rules_length_check
    CHECK (constraint_rules IS NULL OR char_length(constraint_rules) <= 1000),
  CONSTRAINT templates_exception_boundary_rules_length_check
    CHECK (exception_boundary_rules IS NULL OR char_length(exception_boundary_rules) <= 1000),
  CONSTRAINT templates_verification_rules_length_check
    CHECK (verification_rules IS NULL OR char_length(verification_rules) <= 1000)
);

-- statement-breakpoint

-- 将历史逐行 “[key：value]” 文本转换为 JSONB 数组；格式异常时主动终止，避免静默丢失变量。
CREATE OR REPLACE FUNCTION migrate_template_variables(value TEXT)
RETURNS JSONB AS $$
DECLARE
  source_line TEXT;
  matched_parts TEXT[];
  converted_variables JSONB := '[]'::JSONB;
BEGIN
  IF value IS NULL OR btrim(value) = '' THEN
    RETURN converted_variables;
  END IF;

  FOREACH source_line IN ARRAY regexp_split_to_array(value, E'\\r?\\n') LOOP
    matched_parts := regexp_match(source_line, '^\[\s*([^：:]+?)\s*[：:]\s*(.*?)\s*\]$');

    IF matched_parts IS NULL THEN
      RAISE EXCEPTION 'variables 数据格式无法转换：%', source_line;
    END IF;

    converted_variables := converted_variables || jsonb_build_array(
      jsonb_build_object(
        'key', btrim(matched_parts[1]),
        'value', btrim(matched_parts[2])
      )
    );
  END LOOP;

  RETURN converted_variables;
END;
$$ LANGUAGE plpgsql;

-- statement-breakpoint

-- 仅在历史字段仍为 TEXT 时执行类型迁移，使初始化脚本可安全重复运行。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'templates'
      AND column_name = 'variables'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE templates
    ALTER COLUMN variables TYPE JSONB
    USING migrate_template_variables(variables);
  END IF;
END;
$$;

-- statement-breakpoint

-- 历史空值已由转换函数归一为空数组，后续写入也统一使用相同默认值。
ALTER TABLE templates
ALTER COLUMN variables SET DEFAULT '[]'::JSONB;

-- statement-breakpoint

ALTER TABLE templates
ALTER COLUMN variables SET NOT NULL;

-- statement-breakpoint

DROP FUNCTION IF EXISTS migrate_template_variables(TEXT);

-- statement-breakpoint

-- 历史库可能已安装更新时间触发器；版本字段回填属于迁移，不应刷新业务修改时间。
DROP TRIGGER IF EXISTS templates_set_updated_at ON templates;

-- statement-breakpoint

-- 兼容已存在的 templates 表；历史模板统一从版本 1 开始记录。
ALTER TABLE templates
ADD COLUMN IF NOT EXISTS revision BIGINT;

-- statement-breakpoint

UPDATE templates
SET revision = 1
WHERE revision IS NULL;

-- statement-breakpoint

ALTER TABLE templates
ALTER COLUMN revision SET DEFAULT 1;

-- statement-breakpoint

ALTER TABLE templates
ALTER COLUMN revision SET NOT NULL;

-- statement-breakpoint

-- 为已存在的历史表补充数组约束；新建表已在 CREATE TABLE 中包含同名约束。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'templates'::regclass
      AND conname = 'templates_variables_array_check'
  ) THEN
    ALTER TABLE templates
    ADD CONSTRAINT templates_variables_array_check
    CHECK (jsonb_typeof(variables) = 'array');
  END IF;
END;
$$;

-- statement-breakpoint

-- 历史版本保存完整业务快照；模板删除时同步删除其不可独立使用的历史记录。
CREATE TABLE IF NOT EXISTS template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 同一模板的版本号唯一，保证初始化和触发器重复执行时不会制造重复版本。
  CONSTRAINT template_versions_template_revision_unique
    UNIQUE (template_id, revision),

  CONSTRAINT template_versions_revision_check
    CHECK (revision >= 1),

  -- 快照只能包含约定的八个字段，并继续保证 variables 为数组。
  CONSTRAINT template_versions_snapshot_check
    CHECK (
      jsonb_typeof(snapshot) = 'object'
      AND snapshot ?& ARRAY[
        'name',
        'description',
        'variables',
        'explain_structure',
        'consistency_rules',
        'constraint_rules',
        'exception_boundary_rules',
        'verification_rules'
      ]
      AND snapshot - ARRAY[
        'name',
        'description',
        'variables',
        'explain_structure',
        'consistency_rules',
        'constraint_rules',
        'exception_boundary_rules',
        'verification_rules'
      ] = '{}'::JSONB
      AND jsonb_typeof(snapshot -> 'variables') = 'array'
    )
);

-- statement-breakpoint

-- 历史列表按模板和版本倒序读取，索引同时服务于写入后的数量清理。
CREATE INDEX IF NOT EXISTS template_versions_template_revision_idx
ON template_versions (template_id, revision DESC);

-- statement-breakpoint

-- 每次真实业务字段变化后写入更新后的完整快照，并只保留该模板最近 50 个版本。
CREATE OR REPLACE FUNCTION capture_template_version()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO template_versions (
    template_id,
    revision,
    snapshot
  )
  VALUES (
    NEW.id,
    NEW.revision,
    jsonb_build_object(
      'name', NEW.name,
      'description', NEW.description,
      'variables', NEW.variables,
      'explain_structure', NEW.explain_structure,
      'consistency_rules', NEW.consistency_rules,
      'constraint_rules', NEW.constraint_rules,
      'exception_boundary_rules', NEW.exception_boundary_rules,
      'verification_rules', NEW.verification_rules
    )
  )
  ON CONFLICT (template_id, revision) DO NOTHING;

  -- 常规情况下每次只删除第 51 条；OFFSET 也能一次修复意外积累的超额历史。
  DELETE FROM template_versions
  WHERE id IN (
    SELECT id
    FROM template_versions
    WHERE template_id = NEW.id
    ORDER BY revision DESC
    OFFSET 50
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- statement-breakpoint

-- 每次更新模板时刷新修改时间；八个快照字段真实变化时同时递增版本号。
CREATE OR REPLACE FUNCTION set_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();

  IF ROW(
    NEW.name,
    NEW.description,
    NEW.variables,
    NEW.explain_structure,
    NEW.consistency_rules,
    NEW.constraint_rules,
    NEW.exception_boundary_rules,
    NEW.verification_rules
  ) IS DISTINCT FROM ROW(
    OLD.name,
    OLD.description,
    OLD.variables,
    OLD.explain_structure,
    OLD.consistency_rules,
    OLD.constraint_rules,
    OLD.exception_boundary_rules,
    OLD.verification_rules
  ) THEN
    NEW.revision = OLD.revision + 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- statement-breakpoint

-- 重建同名触发器使脚本可以安全重复执行，同时确保它使用最新函数定义。
DROP TRIGGER IF EXISTS templates_set_updated_at ON templates;

-- statement-breakpoint

CREATE TRIGGER templates_set_updated_at
BEFORE UPDATE ON templates
FOR EACH ROW
EXECUTE FUNCTION set_templates_updated_at();

-- statement-breakpoint

-- 新模板立即建立版本 1，确保首次编辑前的状态也可以在未来被恢复。
DROP TRIGGER IF EXISTS templates_capture_initial_version ON templates;

-- statement-breakpoint

CREATE TRIGGER templates_capture_initial_version
AFTER INSERT ON templates
FOR EACH ROW
EXECUTE FUNCTION capture_template_version();

-- statement-breakpoint

-- revision 只会在八个目标字段真实变化时递增，因此其他字段更新不会生成快照。
DROP TRIGGER IF EXISTS templates_capture_updated_version ON templates;

-- statement-breakpoint

CREATE TRIGGER templates_capture_updated_version
AFTER UPDATE ON templates
FOR EACH ROW
WHEN (OLD.revision IS DISTINCT FROM NEW.revision)
EXECUTE FUNCTION capture_template_version();

-- statement-breakpoint

-- 固定 UUID 配合 ON CONFLICT，使以下 9 条 mock 数据重复初始化时不会重复插入。
INSERT INTO templates (
  id,
  name,
  description,
  variables,
  explain_structure,
  consistency_rules,
  constraint_rules,
  exception_boundary_rules,
  verification_rules,
  type,
  status,
  blueprint,
  group_id
)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    '周度销售分析模板',
    '汇总每周销售趋势、目标完成率和重点商品表现。',
    '[{"key":"统计周期","value":"报告覆盖的起止日期"},{"key":"销售目标","value":"本周期销售目标金额"},{"key":"销售数据","value":"本周期销售明细数据"}]'::JSONB,
    '报告由概览、趋势、区域表现和商品排行组成，分别说明目标完成情况、销售变化、区域贡献和重点商品表现。',
    '各模块使用相同的统计周期、币种和销售口径。',
    '所有结论必须基于输入的销售数据。',
    '销售数据为空时说明无法生成分析，不推断销售表现。',
    '核对销售额汇总、目标完成率和商品排行。',
    'report',
    1,
    '/blueprints/weekly-sales.json',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    '月度运营复盘模板',
    '用于展示月度核心运营指标及环比变化。',
    '[{"key":"统计月份","value":"复盘对应的自然月"},{"key":"运营指标","value":"本月及上月核心指标"},{"key":"异常事项","value":"本月异常事件列表"}]'::JSONB,
    '报告包含指标摘要、增长趋势、异常分析和下月行动建议，各模块依次呈现结果、变化、原因和计划。',
    '全篇指标名称、统计口径和时间范围保持一致。',
    '环比结果必须由本月值和上月值计算得出。',
    '指标缺失时明确标注，不使用零值替代。',
    '核验环比计算及行动建议与异常事项的对应关系。',
    'report',
    1,
    '/blueprints/monthly-operations.html',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    '营销活动效果模板',
    '分析活动曝光、转化、成本和渠道贡献。',
    '[{"key":"活动信息","value":"活动名称与周期"},{"key":"渠道数据","value":"各渠道曝光、转化和成本"},{"key":"转化目标","value":"活动目标值"}]'::JSONB,
    '报告拆分为活动总览、转化漏斗、渠道对比和成本收益四个模块。',
    '各渠道统一使用相同的归因窗口和转化定义。',
    '成本收益计算必须使用输入的实际成本。',
    '渠道数据不足时不进行渠道优劣排序。',
    '核验漏斗转化率、渠道汇总值和成本收益。',
    'report',
    1,
    '/blueprints/campaign-performance.json',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000000004',
    '季度财务摘要模板',
    '展示季度收入、支出、利润和预算执行情况。',
    '[{"key":"统计季度","value":"财务摘要所属季度"},{"key":"财务数据","value":"收入、支出及现金流数据"},{"key":"预算数据","value":"季度预算明细"}]'::JSONB,
    '报告依次包含损益摘要、预算偏差、现金流和关键财务风险。',
    '金额单位、币种、会计期间和科目口径保持一致。',
    '利润与预算偏差必须由输入数据计算。',
    '科目数据缺失时标注缺失，不估算金额。',
    '核验收入减支出与利润、预算偏差及现金流汇总。',
    'report',
    0,
    '/blueprints/quarterly-finance.html',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000000005',
    '客户健康度模板',
    '跟踪客户活跃度、满意度、续约风险和服务记录。',
    '[{"key":"客户信息","value":"客户基础信息"},{"key":"行为数据","value":"活跃度与产品使用数据"},{"key":"服务记录","value":"问题及跟进记录"}]'::JSONB,
    '报告包含客户概况、健康评分、风险信号和跟进事项。',
    '健康评分维度和评分周期在各模块中保持一致。',
    '风险判断仅使用提供的行为数据和服务记录。',
    '数据不足时输出待补充项，不生成确定性风险结论。',
    '核验评分依据、风险信号和跟进事项之间的关联。',
    'report',
    1,
    '/blueprints/customer-health.json',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000000006',
    '项目进度周报模板',
    '汇总项目里程碑、当前进度、阻塞项和后续计划。',
    '[{"key":"报告周期","value":"周报覆盖的起止日期"},{"key":"里程碑","value":"项目里程碑及状态"},{"key":"任务数据","value":"任务进度、负责人和截止日期"}]'::JSONB,
    '报告由项目摘要、里程碑进度、风险阻塞和下周计划组成。',
    '任务状态、负责人和日期在各模块中保持一致。',
    '进度结论必须能够追溯到具体任务或里程碑。',
    '缺少最新状态时保留上次状态并明确标注待确认。',
    '核验里程碑状态、阻塞责任人和计划截止日期。',
    'report',
    1,
    '/blueprints/project-progress.html',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000000007',
    '库存分析模板',
    '分析库存周转、缺货风险、滞销商品和补货建议。',
    '[{"key":"统计日期","value":"库存数据截止日期"},{"key":"库存数据","value":"商品库存与出入库明细"},{"key":"补货参数","value":"安全库存和采购周期"}]'::JSONB,
    '报告包含库存指标、品类分布、风险商品和补货清单。',
    '商品编码、库存单位和统计时点保持一致。',
    '周转和补货建议必须依据输入数据与补货参数。',
    '缺少销量或采购周期时不生成补货数量。',
    '核验库存汇总、风险分类和建议补货量。',
    'report',
    1,
    '/blueprints/inventory-analysis.json',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000000008',
    '管理层经营简报模板',
    '为管理层提供跨部门核心经营信息摘要。',
    '[{"key":"报告周期","value":"简报覆盖的时间范围"},{"key":"部门数据","value":"各部门核心指标与动态"},{"key":"决策事项","value":"待管理层决策的问题"}]'::JSONB,
    '报告聚合经营概览、部门动态、重点风险和管理决策事项。',
    '跨部门指标统一时间范围、单位和统计口径。',
    '简报仅保留影响经营判断的关键信息。',
    '部门数据冲突时并列展示并标注待确认。',
    '核验经营指标来源、风险优先级和决策事项完整性。',
    'report',
    0,
    '/blueprints/executive-brief.html',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000000009',
    '风险评估模板',
    '记录风险等级、影响范围、发生概率和应对措施。',
    '[{"key":"评估范围","value":"本次风险评估的对象和边界"},{"key":"风险清单","value":"已识别风险及证据"},{"key":"评估标准","value":"概率与影响分级规则"}]'::JSONB,
    '报告由风险清单、等级矩阵、责任归属和缓解计划组成。',
    '所有风险使用相同的概率和影响分级标准。',
    '风险等级必须依据评估标准计算，不得主观调整。',
    '证据不足的风险标记为待评估，不强制确定等级。',
    '核验风险等级、责任人和缓解措施的对应关系。',
    'report',
    1,
    '/blueprints/risk-assessment.json',
    NULL
  )
ON CONFLICT (id) DO NOTHING;

-- statement-breakpoint

-- 为迁移前已存在的模板补齐当前版本快照；新插入模板已由触发器写入，不会重复。
INSERT INTO template_versions (
  template_id,
  revision,
  snapshot
)
SELECT
  id,
  revision,
  jsonb_build_object(
    'name', name,
    'description', description,
    'variables', variables,
    'explain_structure', explain_structure,
    'consistency_rules', consistency_rules,
    'constraint_rules', constraint_rules,
    'exception_boundary_rules', exception_boundary_rules,
    'verification_rules', verification_rules
  )
FROM templates
ON CONFLICT (template_id, revision) DO NOTHING;

-- statement-breakpoint

-- 初始化重复执行或旧数据导入后统一收敛为每个模板最近 50 条。
DELETE FROM template_versions AS version
USING (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY template_id
      ORDER BY revision DESC
    ) AS position
  FROM template_versions
) AS ranked_version
WHERE version.id = ranked_version.id
  AND ranked_version.position > 50;

-- statement-breakpoint

COMMIT;
