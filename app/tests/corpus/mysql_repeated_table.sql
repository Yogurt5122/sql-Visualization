SELECT a.id, b.id AS parent_id
FROM dwd_order a
JOIN dwd_order b ON b.id = a.parent_order_id
WHERE a.dt = '2024-12-01';
