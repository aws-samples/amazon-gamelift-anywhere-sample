import boto3
from botocore.exceptions import ClientError
import json
import time
import os
import logging

logger = logging.getLogger()

logger.setLevel(logging.DEBUG)

region_name = os.getenv('AWS_REGION')
table_name = os.getenv('TABLE_NAME')
matchmaking_configuration_name = os.getenv('MATCHMAKING_CONFIGURATION_NAME')

dynamodb = boto3.resource('dynamodb', region_name=region_name)
ddb_table = dynamodb.Table(table_name)

def lambda_handler(event, context):
    logger.debug(event)
    
    # You can also use TicketId to track Matchmaking Event.
    ticket_id = event['TicketId']
    player_name = event['PlayerName']
    response = { 'IpAddress': '', 'PlayerSessionId': '', 'Port': 0 }

    match_response = ddb_table.get_item( Key={ 'PlayerName': 'ticket:{}'.format(ticket_id) } )
    if 'Item' in match_response and 'GameSessionInfo' in match_response['Item']:
        logger.debug(match_response['Item'])
        gameSessionInfo = json.loads(match_response['Item']['GameSessionInfo'])
    
        player = next(player for player in gameSessionInfo['players'] if player['playerId'] == player_name)
        response['IpAddress'] = gameSessionInfo['ipAddress']
        response['Port'] = gameSessionInfo['port']
        response['PlayerSessionId'] = player['playerSessionId']

    logger.debug(response)
    return response