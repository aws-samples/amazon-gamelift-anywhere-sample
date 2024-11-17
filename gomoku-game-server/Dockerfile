# syntax=docker/dockerfile:1

FROM ubuntu:22.04

ENV AWS_CONFIG_FILE=/.aws/config

RUN mkdir -p /local/game/logs
RUN mkdir -p /local/game/agent

WORKDIR /local/game

COPY ./config $AWS_CONFIG_FILE
COPY ./gomoku-in-go /local/game/gomoku-in-go

COPY ./GameLiftAgent-1.0.jar /local/game/agent/
COPY ./start_game_session.sh /local/game/start_game_session.sh

RUN chmod +x /local/game/start_game_session.sh
RUN chmod +x /local/game/gomoku-in-go

EXPOSE 4000

RUN apt-get -y update && apt-get -y install ca-certificates curl jq zip openjdk-17-jre

RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && \
	./aws/install

ENV PATH="$PATH:/user/local/bin"

ENTRYPOINT ["./start_game_session.sh"]
