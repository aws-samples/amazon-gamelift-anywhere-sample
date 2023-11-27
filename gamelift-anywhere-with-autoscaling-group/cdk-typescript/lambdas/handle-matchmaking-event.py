import boto3
import json
import time
import os
import logging
from os import environ

logger = logging.getLogger()

logger.setLevel(logging.DEBUG)

region_name = os.getenv('AWS_REGION')
table_name = os.getenv('TABLE_NAME')
expire_seconds = int(os.getenv('EXPIRE_SECONDS', '300'))

dynamodb = boto3.resource('dynamodb', region_name=region_name)
ddb_table = dynamodb.Table(table_name)

accelerator_listener_ip = os.getenv('GLOBAL_ACCELERATOR_IP')
if accelerator_listener_ip is not None and accelerator_listener_ip != "" :
    ddb_table_customportmapping = dynamodb.Table('CustomPortMapping')
    accelerator_listener_ip     = os.getenv('GLOBAL_ACCELERATOR_IP')
else:
    logger.debug("No GLOBAL_ACCELERATOR_IP environment variable")

def lambda_handler(event, context):
    logger.debug(event)

    sns_message = json.loads(event['Records'][0]['Sns']['Message'])
    logger.debug(json.dumps(sns_message, indent=2))
    matchevent_status = sns_message['detail']['type']
    if matchevent_status == 'MatchmakingSucceeded':
        matchId = sns_message['detail']['matchId']
        gamesession_info = sns_message['detail']['gameSessionInfo']
        
        if accelerator_listener_ip is not None and accelerator_listener_ip != "" :
            ipaddr  = gamesession_info['ipAddress']
            port    = gamesession_info['port']

            result = ddb_table_customportmapping.get_item( Key= {'DestinationIpAddress' : ipaddr})
            print("port mapped: ", result)
        
            if 'Item' in result :
                gamesession_info['ipAddress']   = accelerator_listener_ip
                gamesession_info['port']        = int(result['Item']['AcceleratorPort'])
                logger.debug(json.dumps(gamesession_info, indent=2))
        
        expireAt = int(time.time()) + expire_seconds

        with ddb_table.batch_writer() as batch:
            for ticket in sns_message['detail']['tickets']:
                ticket_id = ticket['ticketId']
                batch.put_item(Item = { 'PlayerName': 'ticket:{}'.format(ticket_id), 'MatchId': matchId, 'GameSessionInfo': json.dumps(gamesession_info), 'ExpireAt': expireAt })
