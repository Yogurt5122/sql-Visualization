SELECT a.id, b.id AS parent_id
FROM t_demo_order a
JOIN t_demo_order b ON b.id = a.parent_order_id
WHERE a.dt = '2024-12-01';
