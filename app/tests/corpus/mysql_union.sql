SELECT 'app' AS source, COUNT(*) AS cnt
FROM app_event
WHERE dt = '2024-12-01'
UNION ALL
SELECT 'web' AS source, COUNT(*) AS cnt
FROM web_event
WHERE dt = '2024-12-01';
