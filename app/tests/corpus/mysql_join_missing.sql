SELECT o.id, u.name
FROM t_demo_order o
JOIN t_demo_user_dim u
WHERE o.status = 1;
