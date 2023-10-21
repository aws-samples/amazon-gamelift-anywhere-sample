import boto3
from boto3.dynamodb.conditions import Key
import os
import logging

logger = logging.getLogger()

logger.setLevel(logging.DEBUG)

region_name = os.getenv('AWS_REGION')
table_name = os.getenv('TABLE_NAME')
index_name = os.getenv('INDEX_NAME')
dynamodb = boto3.resource('dynamodb', region_name=region_name)
ddb_table = dynamodb.Table(table_name)

def lambda_handler(event, context):
    ddb_ret = ddb_table.query(
        IndexName=index_name,
        KeyConditionExpression=Key('LeaderboardName').eq('Score'),
        ScanIndexForward=False,
        Limit=100
    )
    logger.debug(ddb_ret)
    ret = [{ 'Player': entry['PlayerName'], 'Score': int(entry['Score']) } for entry in ddb_ret['Items']]
    logger.debug(ret)
    return ret