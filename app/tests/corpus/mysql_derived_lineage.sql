SELECT
  T.TBL_NAME AS "TBL_NAME",
  T.CNT AS "ROW_CNT"
FROM (
  SELECT
    'dwd_asset' AS TBL_NAME,
    COUNT(*) AS CNT
  FROM dwd_asset
) T;
