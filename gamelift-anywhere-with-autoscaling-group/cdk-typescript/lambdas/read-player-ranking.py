import redis
import os
import logging

logger = logging.getLogger()

logger.setLevel(logging.DEBUG)

redis_host = os.getenv('REDIS')
redis = redis.Redis(host=redis_host, db=0)

def lambda_handler(event, context):
    result = redis.zrevrange('Rating', 0, -1, True)
    logger.debug(result)
    ret = [{ 'Player': entry[0].decode('utf-8'), 'Score': int(entry[1]) } for entry in result]
    logger.debug(ret)
    return ret