SELECT
  CASE
    WHEN amount >= 1000 THEN 'high'
    WHEN amount >= 100 THEN 'mid'
    ELSE 'low'
  END AS amount_level,
  COUNT(*) AS cnt
FROM dwd_order
WHERE dt = '2024-12-01'
GROUP BY 1;
