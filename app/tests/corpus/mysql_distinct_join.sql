SELECT DISTINCT u.id, u.name
FROM t_demo_user u
JOIN t_demo_order o ON o.user_id = u.id
WHERE o.dt = '2024-12-01';
