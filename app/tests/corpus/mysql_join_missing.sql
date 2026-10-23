SELECT o.id, u.name
FROM dwd_order o
JOIN dim_user u
WHERE o.status = 1;
