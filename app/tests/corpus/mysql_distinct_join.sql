SELECT DISTINCT u.id, u.name
FROM dwd_user u
JOIN dwd_order o ON o.user_id = u.id
WHERE o.dt = '2024-12-01';
