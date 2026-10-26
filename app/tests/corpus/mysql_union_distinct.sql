SELECT id
FROM t_demo_order
WHERE dt = '2024-12-01'
UNION
SELECT id
FROM t_demo_order_archive
WHERE dt = '2024-12-01';
