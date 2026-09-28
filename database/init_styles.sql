-- 设计风格独立于报告模板保存，只负责 HTML 的视觉语言与信息布局。
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS styles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL,
  description VARCHAR(500) NOT NULL,
  prompt_rules TEXT NOT NULL,
  status SMALLINT NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT styles_name_not_blank_check
    CHECK (btrim(name) <> ''),
  CONSTRAINT styles_description_not_blank_check
    CHECK (btrim(description) <> ''),
  CONSTRAINT styles_prompt_rules_not_blank_check
    CHECK (btrim(prompt_rules) <> ''),
  CONSTRAINT styles_prompt_rules_length_check
    CHECK (char_length(prompt_rules) <= 50000),
  CONSTRAINT styles_status_check
    CHECK (status IN (0, 1)),
  CONSTRAINT styles_default_enabled_check
    CHECK (NOT is_default OR status = 1)
);

-- statement-breakpoint

-- 风格名称用于用户显式指定，因此按忽略大小写的语义保持唯一。
CREATE UNIQUE INDEX IF NOT EXISTS styles_name_lower_unique_idx
ON styles (lower(btrim(name)));

-- statement-breakpoint

-- 报告匹配必须拥有唯一兜底风格；是否至少存在一个默认项由运行时继续校验。
CREATE UNIQUE INDEX IF NOT EXISTS styles_single_default_idx
ON styles (is_default)
WHERE is_default = TRUE;

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS styles_status_updated_at_idx
ON styles (status, updated_at DESC, id DESC);

-- statement-breakpoint

-- 每次修改风格时刷新更新时间，供管理页稳定排序和展示。
CREATE OR REPLACE FUNCTION set_styles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- statement-breakpoint

DROP TRIGGER IF EXISTS styles_set_updated_at ON styles;

-- statement-breakpoint

CREATE TRIGGER styles_set_updated_at
BEFORE UPDATE ON styles
FOR EACH ROW
EXECUTE FUNCTION set_styles_updated_at();
