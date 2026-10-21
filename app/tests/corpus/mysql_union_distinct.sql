SELECT id
FROM dwd_order
WHERE dt = '2024-12-01'
UNION
SELECT id
FROM dwd_order_archive
WHERE dt = '2024-12-01';
