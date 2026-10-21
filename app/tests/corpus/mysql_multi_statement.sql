SELECT COUNT(*) AS order_cnt
FROM dwd_order
WHERE dt = '2024-12-01';

SELECT user_id, SUM(pay_amount) AS gmv
FROM dwd_order
WHERE dt = '2024-12-01'
GROUP BY user_id
ORDER BY gmv DESC
LIMIT 10;
