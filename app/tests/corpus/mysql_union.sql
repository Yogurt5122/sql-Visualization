SELECT 'app' AS source, COUNT(*) AS cnt
FROM t_demo_app_event
WHERE dt = '2024-12-01'
UNION ALL
SELECT 'web' AS source, COUNT(*) AS cnt
FROM t_demo_web_event
WHERE dt = '2024-12-01';
