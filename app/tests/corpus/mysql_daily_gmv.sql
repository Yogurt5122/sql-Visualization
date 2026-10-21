-- 2024-12 每日 GMV：按渠道汇总已支付订单
SELECT
  o.dt,
  o.channel_id,
  COUNT(DISTINCT o.user_id) AS buyer_cnt,
  SUM(o.pay_amount) AS gmv
FROM dwd_order o
JOIN dim_channel c ON c.id = o.channel_id
WHERE o.dt BETWEEN '2024-12-01' AND '2024-12-31'
  AND o.status = 'PAID'
GROUP BY o.dt, o.channel_id
ORDER BY o.dt, gmv DESC
LIMIT 500;
