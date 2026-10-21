SELECT
  DATE_FORMAT(created_at, '%Y-%m') AS month,
  COUNT(*) AS cnt
FROM dwd_order
WHERE created_at >= '2024-01-01'
GROUP BY DATE_FORMAT(created_at, '%Y-%m');
