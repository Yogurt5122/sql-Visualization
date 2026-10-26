SELECT
  T.demo_label AS "demo_label",
  T.demo_count AS "demo_count"
FROM (
  SELECT
    't_demo_asset' AS demo_label,
    COUNT(*) AS demo_count
  FROM t_demo_asset
) T;
