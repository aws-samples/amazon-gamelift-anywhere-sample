# syntax=docker/dockerfile:1

FROM ubuntu:22.04

ENV AWS_CONFIG_FILE=/.aws/config

WORKDIR /

COPY ./config $AWS_CONFIG_FILE
COPY ./gomoku-in-go /gomoku-in-go
COPY ./start_game_session.sh /start_game_session.sh

EXPOSE 4000

RUN apt-get -y update && apt-get -y install ca-certificates curl jq zip

RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && \
	./aws/install

ENV PATH="$PATH:/user/local/bin"

#USER nonroot:nonroot

ENTRYPOINT ["./start_game_session.sh"]
#ENTRYPOINT ["sleep", "1000"]
