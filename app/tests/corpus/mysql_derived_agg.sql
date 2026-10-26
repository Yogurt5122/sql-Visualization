SELECT channel_id, MAX(gmv) AS max_gmv
FROM (
  SELECT channel_id, dt, SUM(pay_amount) AS gmv
  FROM t_demo_order
  WHERE status = 'PAID'
  GROUP BY channel_id, dt
) t
GROUP BY channel_id;
