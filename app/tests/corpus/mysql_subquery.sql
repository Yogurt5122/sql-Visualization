SELECT o.order_id, o.pay_amount
FROM dwd_order o
WHERE o.user_id IN (
  SELECT user_id
  FROM dim_user
  WHERE vip_level >= 3
)
AND o.dt = '2024-12-01';
