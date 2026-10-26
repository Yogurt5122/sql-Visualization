SELECT
  DATEADD(day, -7, GETDATE()) AS start_time,
  COUNT(*) AS cnt
FROM dbo.t_demo_order
WHERE created_at >= DATEADD(day, -7, GETDATE());
