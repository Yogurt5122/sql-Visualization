-- 每个用户最近 3 笔已支付订单
SELECT user_id, order_id, pay_amount, rn
FROM (
  SELECT
    user_id,
    order_id,
    pay_amount,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
  FROM t_demo_order
  WHERE status = 'PAID'
) t
WHERE rn <= 3;
